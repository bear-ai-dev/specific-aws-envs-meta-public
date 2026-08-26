FROM node:22-bookworm

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates curl git jq lsof make procps python3 ripgrep sudo tzdata \
        patch tmux asciinema && \
    rm -rf /var/lib/apt/lists/*

# Lets anything in the image execute the project's TypeScript without a build
# step, which is how the service is exercised locally.
RUN npm install -g --no-audit --no-fund tsx@4.19.2

ENV TZ=Etc/UTC
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN useradd --create-home --shell /bin/bash agent

# Terminal hardening. Agents deliver large files as a single pasted heredoc,
# and a pty wedged partway through that paste costs the whole trial.
COPY --chown=root:root hardening/shell-hardening.sh /etc/profile.d/10-shell-hardening.sh
COPY --chown=root:root hardening/tmux.conf /etc/tmux.conf
RUN chmod 0644 /etc/profile.d/10-shell-hardening.sh /etc/tmux.conf && \
    printf '\n. /etc/profile.d/10-shell-hardening.sh\n' >> /etc/bash.bashrc

# The emulated endpoint is readable but not writable: it stands in for the
# identity provider and the configuration store, it is not part of the
# deliverable.
COPY --chown=root:root mockaws/ /opt/mockaws/mockaws/
RUN chmod -R a+rX /opt/mockaws && \
    find /opt/mockaws -name '__pycache__' -prune -exec rm -rf {} +

# The tenant's identity host has no meaning inside a box with no outbound
# network, so every Node process in the image resolves it to the local
# endpoint. Readable, not writable, and not part of the deliverable.
RUN install -d -m 0755 -o root -g root /opt/meteringco-runtime
COPY --chown=root:root --chmod=0444 runtime/identity-shim.cjs /opt/meteringco-runtime/identity-shim.cjs

# Verifier-only material: the held-out world, the session it is exercised over,
# and the trusted driver. The agent account sees an opaque parent directory and
# nothing inside it. Nothing under here is world readable in any layer, and the
# generator that produced the documents never enters the image.
RUN install -d -m 0700 -o root -g root /var/lib/task-data /var/lib/task-data/verifier
COPY --chown=root:root --chmod=600 verifier-data/ /var/lib/task-data/verifier/

# The world the endpoint serves to the box itself. Readable, tame, and
# unrelated to what the verifier serves.
RUN install -d -m 0755 -o root -g root /opt/meteringco-sandbox
COPY --chown=root:root --chmod=0444 sandbox/ /opt/meteringco-sandbox/

RUN install -d -o agent -g agent /app
WORKDIR /app
COPY --chown=agent:agent workspace/ /app/

# The native snappy binding in the dependency tree has no prebuilt artifact for
# this image and is not on any path the service uses, so install skips scripts.
USER agent
RUN npm install --no-audit --no-fund --ignore-scripts
USER root

# Root-only reference copy of the starting sources, so a finished run can be
# diffed against what the box began with. Nothing reads it during scoring.
RUN install -d -m 0700 -o root -g root /var/lib/task-data/pristine_app && \
    tar -C /app --exclude=./node_modules -cf - . | tar -C /var/lib/task-data/pristine_app -xf - && \
    chown -R root:root /var/lib/task-data/pristine_app && \
    chmod -R go-rwx /var/lib/task-data/pristine_app

COPY --chown=root:root task-init.sh /usr/local/bin/task-init.sh
RUN chmod 0755 /usr/local/bin/task-init.sh

# One address serves the configuration store and the identity provider, so the
# store's URL and the identity host both point at it. The console credentials
# are the ones this deployment administers its own tenant with.
ENV INFLUX_URL=http://127.0.0.1:4566 \
    INFLUX_ORG=meteringco \
    INFLUX_TOKEN=local-config-token \
    IDENTITY_PROVIDER_PORT=4566 \
    AUTH0_ISSUER_URL=https://auth.meteringco.example/ \
    AUTH0_AUDIENCE=https://example1234.execute-api.us-east-1.amazonaws.com \
    METERINGCO_DASHBOARD_CLIENT_ID=dashHarbourConsoleMgmt01 \
    METERINGCO_DASHBOARD_CLIENT_SECRET=console-management-secret-sandbox \
    SESSION_SECRET=local-session-secret \
    STAGE=local \
    NODE_OPTIONS="--max-old-space-size=3072 --require /opt/meteringco-runtime/identity-shim.cjs" \
    PYTHONDONTWRITEBYTECODE=1

ENTRYPOINT ["/usr/local/bin/task-init.sh"]
CMD ["--wait"]
