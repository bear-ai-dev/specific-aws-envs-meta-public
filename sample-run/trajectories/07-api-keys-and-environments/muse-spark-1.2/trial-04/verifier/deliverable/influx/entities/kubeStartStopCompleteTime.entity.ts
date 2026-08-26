import { Point } from '@influxdata/influxdb-client';
import { OfferingPackageEntity } from '../../offering/entities/offeringPackage.entity.js';
import { InfluxService } from '../influx.service.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class KubeStartTimeInfluxRow extends BaseInfluxTable {
    public static _measurement = 'meteringco_kube_pod_start_time';

    /**
     * This Unix time of when the pod started
     * @example 1669327781
     */
    public declare _value: number;

    public declare _field: string;

    /**
     * The name of the measurement as it appears in the cluster
     * @example "kube_pod_start_time"
     *
     */
    public __name__: string;

    /**
     * The Unique ID associated with your specific business account
     * @example myCoolCorp
     */
    public businessID: string;

    /**
     * The instance of kubestatemetrics within the cluster which took the measurement
     * It is NOT the instance in AWS. See the example for a domain path of an instance of kube_state_metrics in the cluster
     * @example "kube-state-metrics.kube-system.svc.cluster.local:8080"
     *
     *
     */
    public instance?: string;

    /**
     * The namespace inside of kubernetes where the pod is deployed
     * @example default
     * @example myCoolCorp-abc95234
     *
     *
     */
    public namespace?: string;

    /**
     * The Pod's unique ID within the cluster
     * @example meteringco-agent-transformer-668d64c95d-wm9ms
     * @example aws-node-jxvg8
     *
     *
     */
    public pod?: string;

    /**
     * The unique ID for the pod
     * @example 840c390e-53c3-4176-a01d-caf26958228c
     * @example e85eecdf-8db0-475e-a780-78b45288a76c
     *
     *
     */
    public uid?: string;

    constructor({ namespace, uid, instance, businessID, __name__, _field, _value, pod }) {
        super();
        this.pod = pod;
        this.namespace = namespace;
        this.uid = uid;
        this.instance = instance;
        this.businessID = businessID;
        this.__name__ = __name__;
        this._field = _field;
        this._value = _value;
    }

    static transformer(kubeStartTimeInfluxRow: KubeStartTimeInfluxRow, influxService: InfluxService): Array<Point> {
        // Create a point with the measurement in the class
        const point = new Point(KubeStartTimeInfluxRow._measurement);
        // Create a tag for each field in the class
        point.tag('businessID', kubeStartTimeInfluxRow.businessID);
        point.tag('namespace', kubeStartTimeInfluxRow.namespace);
        point.tag('uid', kubeStartTimeInfluxRow.uid);
        point.tag('instance', kubeStartTimeInfluxRow.instance);
        point.tag('pod', kubeStartTimeInfluxRow.pod);
        point.tag('__name__', kubeStartTimeInfluxRow.__name__);
        // Create a field for each field in the class
        point.intField(`${kubeStartTimeInfluxRow._field}`, kubeStartTimeInfluxRow._value);
        // Return the point
        return [point];
    }
}

export class KubeCompletionTimeInfluxRow extends BaseInfluxTable {
    public static _measurement = 'meteringco_kube_pod_completion_time';

    /**
     * This Unix time of when the pod completed
     * @example 1669327781
     */
    public declare _value: number;

    /**
     * The name of the measurement as it appears in the cluster
     * @example "kube_pod_completion_time"
     *
     */
    public __name__: string;

    public declare _field: string;

    /**
     * The Unique ID associated with your specific business account
     * @example myCoolCorp
     */
    public businessID: string;

    /**
     * The instance of kubestatemetrics within the cluster which took the measurement
     * It is NOT the instance in AWS. See the example for a domain path of an instance of kube_state_metrics in the cluster
     * @example "kube-state-metrics.kube-system.svc.cluster.local:8080"
     *
     *
     */
    public instance?: string;

    /**
     * The namespace inside of kubernetes where the pod is deployed
     * @example default
     * @example myCoolCorp-abc95234
     *
     *
     */
    public namespace?: string;

    /**
     * The name of the job which tracked the completion of the metrics
     * @example kube-state-metrics
     *
     *
     */
    public job?: string;

    /**
     * The Pod's unique ID within the cluster
     * @example meteringco-agent-transformer-668d64c95d-wm9ms
     * @example aws-node-jxvg8
     *
     *
     */
    public pod?: string;

    /**
     * The unique ID for the pod
     * @example 840c390e-53c3-4176-a01d-caf26958228c
     * @example e85eecdf-8db0-475e-a780-78b45288a76c
     *
     *
     */
    public uid?: string;

    constructor({ namespace, uid, instance, businessID, __name__, _field, _value, job, pod }) {
        super();
        this.namespace = namespace;
        this.uid = uid;
        this.instance = instance;
        this.businessID = businessID;
        this.__name__ = __name__;
        this._field = _field;
        this.job = job;
        this._value = _value;
        this.pod = pod;
    }

    static transformer(
        kubeCompletionTimeInfluxRow: KubeCompletionTimeInfluxRow,
        influxService: InfluxService,
    ): Array<Point> {
        // Take in a pricing package entity
        // Return a collection of points to be commited to TSDB

        const aggregatePriceDocumentPoint = influxService.getPoint(OfferingPackageEntity._measurement);

        aggregatePriceDocumentPoint.intField(
            `${kubeCompletionTimeInfluxRow._field}`,
            kubeCompletionTimeInfluxRow._value,
        );

        aggregatePriceDocumentPoint.tag('uid', kubeCompletionTimeInfluxRow.uid);
        aggregatePriceDocumentPoint.tag('instance', kubeCompletionTimeInfluxRow.instance);
        aggregatePriceDocumentPoint.tag('businessID', kubeCompletionTimeInfluxRow.businessID);
        aggregatePriceDocumentPoint.tag('__name__', kubeCompletionTimeInfluxRow.__name__);
        aggregatePriceDocumentPoint.tag('job', kubeCompletionTimeInfluxRow.job);
        aggregatePriceDocumentPoint.tag('pod', kubeCompletionTimeInfluxRow.pod);
        aggregatePriceDocumentPoint.tag('namespace', kubeCompletionTimeInfluxRow.namespace);

        return [aggregatePriceDocumentPoint];
    }
}

export class KubeDeletionTimeInfluxRow extends BaseInfluxTable {
    public static _measurement = 'meteringco_kube_pod_deletion_timestamp';

    /**
     * This Unix time of when the pod was terminated
     * @example 1669327781
     */
    public declare _value: number;

    /**
     * The name of the measurement as it appears in the cluster
     * @example "kube_pod_deletion_timestamp"
     *
     */
    public __name__: string;

    public declare _field: string;

    /**
     * The Unique ID associated with your specific business account
     * @example myCoolCorp
     */
    public businessID: string;

    /**
     * The namespace inside of kubernetes where the pod is deployed
     * @example default
     * @example myCoolCorp-abc95234
     *
     *
     */
    public namespace?: string;

    /**
     * The Pod's name within the cluster
     * @example meteringco-agent-transformer-668d64c95d-wm9ms
     * @example aws-node-jxvg8
     *
     *
     */
    public pod?: string;

    /**
     * The unique ID for the pod
     * @example 840c390e-53c3-4176-a01d-caf26958228c
     * @example e85eecdf-8db0-475e-a780-78b45288a76c
     *
     *
     */
    public uid?: string;

    constructor({ namespace, uid, businessID, __name__, _field, _value, pod }) {
        super();
        this.namespace = namespace;
        this.uid = uid;
        this.businessID = businessID;
        this.__name__ = __name__;
        this._field = _field;
        this._value = _value;
        this.pod = pod;
    }

    static transformer(
        kubeDeletionTimeInfluxRow: KubeDeletionTimeInfluxRow,
        influxService: InfluxService,
    ): Array<Point> {
        // Take in a pricing package entity
        // Return a collection of points to be commited to TSDB

        const aggregatePriceDocumentPoint = influxService.getPoint(OfferingPackageEntity._measurement);

        aggregatePriceDocumentPoint.intField(`${kubeDeletionTimeInfluxRow._field}`, kubeDeletionTimeInfluxRow._value);

        aggregatePriceDocumentPoint.tag('uid', kubeDeletionTimeInfluxRow.uid);
        aggregatePriceDocumentPoint.tag('businessID', kubeDeletionTimeInfluxRow.businessID);
        aggregatePriceDocumentPoint.tag('__name__', kubeDeletionTimeInfluxRow.__name__);
        aggregatePriceDocumentPoint.tag('namespace', kubeDeletionTimeInfluxRow.namespace);
        aggregatePriceDocumentPoint.tag('pod', kubeDeletionTimeInfluxRow.pod);

        return [aggregatePriceDocumentPoint];
    }
}
