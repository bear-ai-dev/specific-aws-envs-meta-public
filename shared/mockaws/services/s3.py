"""S3 (rest-xml). Path-style and virtual-host addressing are both accepted."""

from __future__ import annotations

import time
from datetime import datetime, timezone

from ..state import (
    Bucket,
    IntelligentTieringConfiguration,
    LifecycleRule,
    ObjectFilter,
    ObjectVersion,
    ReplicationRule,
    World,
    iso,
    rfc1123,
)
from ..wire import (
    XMLNS_S3,
    Request,
    Response,
    decode_path,
    error_s3,
    escape,
    tag,
    xml_response,
)

UTC = timezone.utc
DEFAULT_MAX_KEYS = 1000


def _split_target(req: Request) -> tuple[str | None, str]:
    host = req.header("host").split(":")[0]
    path = decode_path(req.path).lstrip("/")
    # Virtual-host style: <bucket>.s3.<region>.amazonaws.com / <bucket>.localhost
    if host and not host.replace(".", "").isdigit():
        labels = host.split(".")
        if len(labels) > 1 and labels[0] not in ("s3", "localhost", "mockaws"):
            return labels[0], path
    if not path:
        return None, ""
    bucket, _, key = path.partition("/")
    return bucket, key


def _visible(version: ObjectVersion, now: float) -> bool:
    return version.visible_at <= now


def handle(world: World, req: Request, injector) -> Response:
    bucket_name, key = _split_target(req)
    query = req.query

    if bucket_name is None:
        if req.method == "GET":
            return _list_buckets(world)
        return error_s3("MethodNotAllowed", "Unsupported service-level operation", 405)

    found = world.find_bucket(bucket_name)
    if found is None:
        if req.method == "PUT" and not key:
            return _create_bucket(world, bucket_name)
        return error_s3("NoSuchBucket", f"The specified bucket does not exist: {bucket_name}", 404, bucket_name)
    account, bucket = found

    if not key:
        if req.method == "HEAD":
            return Response(status=200)
        if "versioning" in query:
            if req.method == "PUT":
                return _put_versioning(bucket, req)
            return _get_versioning(bucket)
        if "encryption" in query:
            if req.method == "PUT":
                bucket.encryption = "AES256"
                return Response(status=200)
            return _get_encryption(bucket)
        if "location" in query:
            body = f'<LocationConstraint xmlns="{XMLNS_S3}">{escape(bucket.region)}</LocationConstraint>'
            return xml_response(body)
        if "versions" in query:
            return _list_object_versions(bucket, query, injector)
        if "lifecycle" in query and req.method == "GET":
            return _get_lifecycle_configuration(bucket)
        if "intelligent-tiering" in query and req.method == "GET":
            return _intelligent_tiering(bucket, query)
        if "replication" in query and req.method == "GET":
            return _get_replication(bucket)
        if "requestPayment" in query and req.method == "GET":
            return _get_request_payment(bucket)
        if "uploads" in query and req.method == "GET":
            return _list_multipart_uploads(bucket, query, injector)
        if req.method == "GET":
            return _list_objects_v2(bucket, query, injector)
        return error_s3("MethodNotAllowed", "Unsupported bucket operation", 405, bucket_name)

    if "tagging" in query and req.method == "GET":
        return _get_object_tagging(bucket, key, query)
    if "uploadId" in query and req.method == "GET":
        return _list_parts(bucket, key, query, injector)
    if req.method in ("GET", "HEAD"):
        return _get_object(bucket, key, query, head=req.method == "HEAD")
    if req.method == "PUT":
        return _put_object(world, bucket, key, req, injector)
    if req.method == "DELETE":
        return _delete_object(world, bucket, key, query)
    return error_s3("MethodNotAllowed", "Unsupported object operation", 405, key)


def _list_buckets(world: World) -> Response:
    entries = []
    for account in world.accounts.values():
        for bucket in account.buckets.values():
            entries.append(
                f"<Bucket>{tag('Name', bucket.name)}{tag('CreationDate', iso(bucket.created))}</Bucket>"
            )
    body = (
        f'<ListAllMyBucketsResult xmlns="{XMLNS_S3}">'
        "<Owner><ID>mockaws</ID><DisplayName>mockaws</DisplayName></Owner>"
        f"<Buckets>{''.join(entries)}</Buckets>"
        "</ListAllMyBucketsResult>"
    )
    return xml_response(body)


def _create_bucket(world: World, name: str) -> Response:
    account = next(iter(world.accounts.values()))
    account.buckets[name] = Bucket(name=name, region=world.region)
    return Response(status=200, headers={"Location": f"/{name}"})


def _get_versioning(bucket: Bucket) -> Response:
    inner = "" if bucket.versioning == "Disabled" else tag("Status", bucket.versioning)
    return xml_response(f'<VersioningConfiguration xmlns="{XMLNS_S3}">{inner}</VersioningConfiguration>')


def _put_versioning(bucket: Bucket, req: Request) -> Response:
    bucket.versioning = "Enabled" if "<Status>Enabled</Status>" in req.text else "Suspended"
    return Response(status=200)


def _get_encryption(bucket: Bucket) -> Response:
    if not bucket.encryption:
        return error_s3(
            "ServerSideEncryptionConfigurationNotFoundError",
            "The server side encryption configuration was not found",
            404,
            bucket.name,
        )
    body = (
        f'<ServerSideEncryptionConfiguration xmlns="{XMLNS_S3}">'
        "<Rule><ApplyServerSideEncryptionByDefault>"
        f"{tag('SSEAlgorithm', bucket.encryption)}"
        "</ApplyServerSideEncryptionByDefault></Rule>"
        "</ServerSideEncryptionConfiguration>"
    )
    return xml_response(body)


def _list_objects_v2(bucket: Bucket, query: dict[str, str], injector) -> Response:
    prefix = query.get("prefix", "")
    delimiter = query.get("delimiter", "")
    token = query.get("continuation-token", "")
    requested = int(query.get("max-keys", DEFAULT_MAX_KEYS))
    max_keys = injector.page_size("s3", "ListObjectsV2", min(requested, DEFAULT_MAX_KEYS))
    now = time.time()

    live: list[tuple[str, ObjectVersion]] = []
    for key in sorted(bucket.objects):
        if not key.startswith(prefix):
            continue
        version = bucket.live_version(key)
        if version is None or not _visible(version, now):
            continue
        live.append((key, version))

    common_prefixes: list[str] = []
    if delimiter:
        collapsed: list[tuple[str, ObjectVersion]] = []
        seen: set[str] = set()
        for key, version in live:
            remainder = key[len(prefix) :]
            head, sep, _ = remainder.partition(delimiter)
            if sep:
                candidate = prefix + head + delimiter
                if candidate not in seen:
                    seen.add(candidate)
                    common_prefixes.append(candidate)
            else:
                collapsed.append((key, version))
        live = collapsed

    start = 0
    if token:
        for index, (key, _) in enumerate(live):
            if key > token:
                start = index
                break
        else:
            start = len(live)
    page = live[start : start + max_keys]
    truncated = start + max_keys < len(live)

    contents = "".join(
        "<Contents>"
        f"{tag('Key', key)}{tag('LastModified', iso(version.last_modified))}"
        f"<ETag>&quot;{version.etag}&quot;</ETag>"
        f"{tag('Size', version.size)}{tag('StorageClass', version.storage_class)}"
        "</Contents>"
        for key, version in page
    )
    prefixes = "".join(f"<CommonPrefixes>{tag('Prefix', value)}</CommonPrefixes>" for value in common_prefixes)
    next_token = tag("NextContinuationToken", page[-1][0]) if truncated and page else ""
    body = (
        f'<ListBucketResult xmlns="{XMLNS_S3}">'
        f"{tag('Name', bucket.name)}{tag('Prefix', prefix)}{tag('MaxKeys', max_keys)}"
        f"{tag('KeyCount', len(page) + len(common_prefixes))}"
        f"{tag('IsTruncated', 'true' if truncated else 'false')}"
        f"{tag('Delimiter', delimiter) if delimiter else ''}"
        f"{next_token}{contents}{prefixes}"
        "</ListBucketResult>"
    )
    return xml_response(body)


def _list_object_versions(bucket: Bucket, query: dict[str, str], injector) -> Response:
    prefix = query.get("prefix", "")
    requested = int(query.get("max-keys", DEFAULT_MAX_KEYS))
    max_keys = injector.page_size("s3", "ListObjectVersions", min(requested, DEFAULT_MAX_KEYS))
    key_marker = query.get("key-marker", "")
    version_marker = query.get("version-id-marker", "")
    now = time.time()

    flat: list[tuple[str, ObjectVersion, bool]] = []
    for key in sorted(bucket.objects):
        if not key.startswith(prefix):
            continue
        chain = bucket.objects[key]
        for index, version in enumerate(chain):
            if not _visible(version, now):
                continue
            is_latest = index == len(chain) - 1
            flat.append((key, version, is_latest))

    start = 0
    if key_marker:
        for index, (key, version, _) in enumerate(flat):
            if key > key_marker or (key == key_marker and version.version_id > version_marker):
                start = index
                break
        else:
            start = len(flat)
    page = flat[start : start + max_keys]
    truncated = start + max_keys < len(flat)

    parts = []
    for key, version, is_latest in page:
        common = (
            f"{tag('Key', key)}{tag('VersionId', version.version_id)}"
            f"{tag('IsLatest', 'true' if is_latest else 'false')}"
            f"{tag('LastModified', iso(version.last_modified))}"
        )
        if version.is_delete_marker:
            parts.append(f"<DeleteMarker>{common}</DeleteMarker>")
        else:
            parts.append(
                "<Version>"
                f"{common}<ETag>&quot;{version.etag}&quot;</ETag>"
                f"{tag('Size', version.size)}{tag('StorageClass', version.storage_class)}"
                "</Version>"
            )
    markers = ""
    if truncated and page:
        last_key, last_version, _ = page[-1]
        markers = tag("NextKeyMarker", last_key) + tag("NextVersionIdMarker", last_version.version_id)
    body = (
        f'<ListVersionsResult xmlns="{XMLNS_S3}">'
        f"{tag('Name', bucket.name)}{tag('Prefix', prefix)}{tag('MaxKeys', max_keys)}"
        f"{tag('IsTruncated', 'true' if truncated else 'false')}{markers}"
        f"{''.join(parts)}"
        "</ListVersionsResult>"
    )
    return xml_response(body)


def _resolve_version(bucket: Bucket, key: str, version_id: str | None) -> ObjectVersion | None:
    chain = bucket.objects.get(key)
    if not chain:
        return None
    if version_id:
        for version in chain:
            if version.version_id == version_id:
                return version
        return None
    newest = chain[-1]
    return None if newest.is_delete_marker else newest


def _get_object(bucket: Bucket, key: str, query: dict[str, str], head: bool) -> Response:
    version = _resolve_version(bucket, key, query.get("versionId"))
    if version is None:
        return error_s3("NoSuchKey", f"The specified key does not exist: {key}", 404, key)
    # Objects the scenario declared by size alone hold only a prefix in memory.
    # HEAD advertises the declared size (that is what billing reads); a GET
    # serves, and therefore declares, the bytes actually available.
    content_length = version.size if head else len(version.body)
    headers = {
        "Content-Type": version.metadata.get("content-type", "application/octet-stream"),
        "Content-Length": str(content_length),
        "ETag": f'"{version.etag}"',
        "Last-Modified": rfc1123(version.last_modified),
        "x-amz-version-id": version.version_id,
        "x-amz-storage-class": version.storage_class,
    }
    if version.sse:
        headers["x-amz-server-side-encryption"] = version.sse
    for name, value in version.metadata.items():
        if name.startswith("x-amz-meta-"):
            headers[name] = value
    return Response(status=200, body=b"" if head else version.body, headers=headers)


def _put_object(world: World, bucket: Bucket, key: str, req: Request, injector) -> Response:
    now = datetime.now(tz=UTC)
    index = len(bucket.objects.get(key, []))
    version = ObjectVersion(
        version_id=world._version_id(bucket.name, key, index),
        body=req.body,
        last_modified=now,
        storage_class=req.header("x-amz-storage-class", "STANDARD"),
        metadata={
            name: value
            for name, value in req.headers.items()
            if name.startswith("x-amz-meta-") or name == "content-type"
        },
        sse=req.header("x-amz-server-side-encryption") or bucket.encryption,
        visible_at=time.time() + injector.list_lag_seconds("s3", "PutObject"),
    )
    bucket.put(key, version)
    headers = {"ETag": f'"{version.etag}"', "x-amz-version-id": version.version_id}
    if version.sse:
        headers["x-amz-server-side-encryption"] = version.sse
    return Response(status=200, headers=headers)


def _delete_object(world: World, bucket: Bucket, key: str, query: dict[str, str]) -> Response:
    version_id = query.get("versionId")
    chain = bucket.objects.get(key)
    if not chain:
        return Response(status=204)
    if version_id:
        bucket.objects[key] = [v for v in chain if v.version_id != version_id]
        if not bucket.objects[key]:
            del bucket.objects[key]
        return Response(status=204, headers={"x-amz-version-id": version_id})
    if bucket.versioning_enabled:
        marker = ObjectVersion(
            version_id=world._version_id(bucket.name, key, len(chain)),
            body=b"",
            last_modified=datetime.now(tz=UTC),
            is_delete_marker=True,
        )
        chain.append(marker)
        return Response(status=204, headers={"x-amz-delete-marker": "true", "x-amz-version-id": marker.version_id})
    del bucket.objects[key]
    return Response(status=204)


# ---------------------------------------------------------------------------
# Lifecycle, tagging, multipart and intelligent-tiering.
#
# Everything below this line is additive: the operations above do not call into
# it, and a scenario that declares none of these sub-documents behaves exactly
# as it did before they existed.
# ---------------------------------------------------------------------------


def _filter_xml(object_filter: ObjectFilter) -> str:
    """Render a `Filter` element the way S3 does: bare when there is a single
    predicate, wrapped in `<And>` when there is more than one. The `Tags` member
    of an And-operator is flattened, so each tag is a bare `<Tag>` child."""
    prefix_xml = tag("Prefix", object_filter.prefix) if object_filter.prefix else ""
    tags_xml = "".join(
        f"<Tag>{tag('Key', predicate.key)}{tag('Value', predicate.value)}</Tag>"
        for predicate in object_filter.tags
    )
    predicates = (1 if object_filter.prefix else 0) + len(object_filter.tags)
    if predicates == 0:
        return "<Filter></Filter>"
    if predicates == 1:
        return f"<Filter>{prefix_xml}{tags_xml}</Filter>"
    return f"<Filter><And>{prefix_xml}{tags_xml}</And></Filter>"


def _lifecycle_rule_xml(rule: LifecycleRule) -> str:
    transitions = "".join(
        f"<Transition>{tag('Days', transition.days)}"
        f"{tag('StorageClass', transition.storage_class)}</Transition>"
        for transition in sorted(rule.transitions, key=lambda item: item.days)
    )
    return (
        "<Rule>"
        f"{tag('ID', rule.rule_id)}"
        f"{_filter_xml(rule.filter)}"
        f"{tag('Status', rule.status)}"
        f"{transitions}"
        "</Rule>"
    )


def _get_lifecycle_configuration(bucket: Bucket) -> Response:
    if not bucket.lifecycle_rules:
        return error_s3(
            "NoSuchLifecycleConfiguration",
            "The lifecycle configuration does not exist",
            404,
            bucket.name,
        )
    rules = "".join(_lifecycle_rule_xml(rule) for rule in bucket.lifecycle_rules)
    return xml_response(f'<LifecycleConfiguration xmlns="{XMLNS_S3}">{rules}</LifecycleConfiguration>')


def _replication_rule_xml(rule: ReplicationRule) -> str:
    destination = f"{tag('Bucket', rule.destination_arn)}"
    if rule.destination_storage_class:
        destination += tag("StorageClass", rule.destination_storage_class)
    return (
        "<Rule>"
        f"{tag('ID', rule.rule_id)}"
        f"{tag('Priority', rule.priority)}"
        f"{_filter_xml(rule.filter)}"
        f"{tag('Status', rule.status)}"
        "<DeleteMarkerReplication><Status>Disabled</Status></DeleteMarkerReplication>"
        f"<Destination>{destination}</Destination>"
        "</Rule>"
    )


def _get_replication(bucket: Bucket) -> Response:
    if not bucket.replication_rules:
        return error_s3(
            "ReplicationConfigurationNotFoundError",
            "The replication configuration was not found",
            404,
            bucket.name,
        )
    rules = "".join(_replication_rule_xml(rule) for rule in bucket.replication_rules)
    body = (
        f'<ReplicationConfiguration xmlns="{XMLNS_S3}">'
        f"{tag('Role', bucket.replication_role)}"
        f"{rules}"
        "</ReplicationConfiguration>"
    )
    return xml_response(body)


def _get_request_payment(bucket: Bucket) -> Response:
    body = (
        f'<RequestPaymentConfiguration xmlns="{XMLNS_S3}">'
        f"{tag('Payer', bucket.request_payer)}"
        "</RequestPaymentConfiguration>"
    )
    return xml_response(body)


def _intelligent_tiering_xml(config: IntelligentTieringConfiguration) -> str:
    tierings = "".join(
        f"<Tiering>{tag('Days', tiering.days)}{tag('AccessTier', tiering.access_tier)}</Tiering>"
        for tiering in sorted(config.tierings, key=lambda item: item.days)
    )
    return (
        "<IntelligentTieringConfiguration>"
        f"{tag('Id', config.config_id)}"
        f"{_filter_xml(config.filter)}"
        f"{tag('Status', config.status)}"
        f"{tierings}"
        "</IntelligentTieringConfiguration>"
    )


def _intelligent_tiering(bucket: Bucket, query: dict[str, str]) -> Response:
    config_id = query.get("id")
    if config_id:
        for config in bucket.intelligent_tiering:
            if config.config_id == config_id:
                body = _intelligent_tiering_xml(config)
                return xml_response(body.replace("<IntelligentTieringConfiguration>", f'<IntelligentTieringConfiguration xmlns="{XMLNS_S3}">', 1))
        return error_s3(
            "NoSuchConfiguration", "The specified configuration does not exist", 404, bucket.name
        )
    configs = "".join(_intelligent_tiering_xml(config) for config in bucket.intelligent_tiering)
    body = (
        f'<ListBucketIntelligentTieringConfigurationsOutput xmlns="{XMLNS_S3}">'
        f"{tag('IsTruncated', 'false')}{configs}"
        "</ListBucketIntelligentTieringConfigurationsOutput>"
    )
    return xml_response(body)


def _get_object_tagging(bucket: Bucket, key: str, query: dict[str, str]) -> Response:
    version = _resolve_version(bucket, key, query.get("versionId"))
    if version is None:
        return error_s3("NoSuchKey", f"The specified key does not exist: {key}", 404, key)
    tags = "".join(
        f"<Tag>{tag('Key', name)}{tag('Value', value)}</Tag>"
        for name, value in sorted(version.tags.items())
    )
    body = f'<Tagging xmlns="{XMLNS_S3}"><TagSet>{tags}</TagSet></Tagging>'
    return Response(
        status=200,
        body=('<?xml version="1.0" encoding="UTF-8"?>\n' + body).encode(),
        headers={"Content-Type": "application/xml", "x-amz-version-id": version.version_id},
    )


def _list_multipart_uploads(bucket: Bucket, query: dict[str, str], injector) -> Response:
    prefix = query.get("prefix", "")
    requested = int(query.get("max-uploads", DEFAULT_MAX_KEYS))
    max_uploads = injector.page_size("s3", "ListMultipartUploads", min(requested, DEFAULT_MAX_KEYS))
    key_marker = query.get("key-marker", "")
    upload_marker = query.get("upload-id-marker", "")

    selected = [
        upload
        for upload in sorted(bucket.multipart_uploads, key=lambda item: (item.key, item.upload_id))
        if upload.key.startswith(prefix)
    ]

    start = 0
    if key_marker:
        for index, upload in enumerate(selected):
            if upload.key > key_marker or (
                upload.key == key_marker and upload.upload_id > upload_marker
            ):
                start = index
                break
        else:
            start = len(selected)
    page = selected[start : start + max_uploads]
    truncated = start + max_uploads < len(selected)

    entries = "".join(
        "<Upload>"
        f"{tag('Key', upload.key)}{tag('UploadId', upload.upload_id)}"
        "<Initiator><ID>mockaws</ID><DisplayName>mockaws</DisplayName></Initiator>"
        "<Owner><ID>mockaws</ID><DisplayName>mockaws</DisplayName></Owner>"
        f"{tag('StorageClass', upload.storage_class)}{tag('Initiated', iso(upload.initiated))}"
        "</Upload>"
        for upload in page
    )
    markers = ""
    if truncated and page:
        markers = tag("NextKeyMarker", page[-1].key) + tag("NextUploadIdMarker", page[-1].upload_id)
    body = (
        f'<ListMultipartUploadsResult xmlns="{XMLNS_S3}">'
        f"{tag('Bucket', bucket.name)}{tag('Prefix', prefix)}{tag('MaxUploads', max_uploads)}"
        f"{tag('KeyMarker', key_marker)}{tag('UploadIdMarker', upload_marker)}"
        f"{tag('IsTruncated', 'true' if truncated else 'false')}{markers}{entries}"
        "</ListMultipartUploadsResult>"
    )
    return xml_response(body)


def _list_parts(bucket: Bucket, key: str, query: dict[str, str], injector) -> Response:
    upload_id = query.get("uploadId", "")
    upload = next(
        (
            candidate
            for candidate in bucket.multipart_uploads
            if candidate.key == key and candidate.upload_id == upload_id
        ),
        None,
    )
    if upload is None:
        return error_s3(
            "NoSuchUpload",
            "The specified multipart upload does not exist",
            404,
            key,
        )

    requested = int(query.get("max-parts", DEFAULT_MAX_KEYS))
    max_parts = injector.page_size("s3", "ListParts", min(requested, DEFAULT_MAX_KEYS))
    marker = int(query.get("part-number-marker", 0) or 0)

    remaining = [part for part in upload.parts if part.part_number > marker]
    page = remaining[:max_parts]
    truncated = len(remaining) > max_parts

    entries = "".join(
        "<Part>"
        f"{tag('PartNumber', part.part_number)}{tag('LastModified', iso(part.last_modified))}"
        f"<ETag>&quot;{part.etag}&quot;</ETag>{tag('Size', part.size)}"
        "</Part>"
        for part in page
    )
    next_marker = tag("NextPartNumberMarker", page[-1].part_number) if truncated and page else ""
    body = (
        f'<ListPartsResult xmlns="{XMLNS_S3}">'
        f"{tag('Bucket', bucket.name)}{tag('Key', key)}{tag('UploadId', upload.upload_id)}"
        f"{tag('PartNumberMarker', marker)}{tag('MaxParts', max_parts)}"
        f"{tag('IsTruncated', 'true' if truncated else 'false')}{next_marker}"
        f"{entries}{tag('StorageClass', upload.storage_class)}"
        "</ListPartsResult>"
    )
    return xml_response(body)
