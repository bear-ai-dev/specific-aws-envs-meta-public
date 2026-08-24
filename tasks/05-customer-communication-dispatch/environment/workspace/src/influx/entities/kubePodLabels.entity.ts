import { Point } from '@influxdata/influxdb-client';
import { InfluxService } from '../influx.service.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class KubeLabelsInfluxRow extends BaseInfluxTable {
    public static _measurement = 'meteringco_kube_pod_labels';

    /**
     * This Unix time of when the pod was terminated
     * @example 1669327781
     */
    public declare _value: number;

    /**
     * The name of the measurement as it appears in the cluster
     * @example "kube_pod_labels"
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

    /**
     * The labels associated with the table
     */
    public labels: Array<{ name: string; value: string }>;

    constructor({ namespace, uid, businessID, __name__, _field, _value, pod, labels }) {
        super();
        this.namespace = namespace;
        this.uid = uid;
        this.businessID = businessID;
        this.__name__ = __name__;
        this._field = _field;
        this._value = _value;
        this.pod = pod;
        this.labels = labels;
    }

    static transformer(kubeLabelsInfluxRow: KubeLabelsInfluxRow, influxService: InfluxService): Array<Point> {
        // Take in a pricing package entity
        // Return a collection of points to be commited to TSDB

        const kubeLabelDocumentPoint = influxService.getPoint(KubeLabelsInfluxRow._measurement);

        kubeLabelDocumentPoint.intField(`${kubeLabelsInfluxRow._field}`, kubeLabelsInfluxRow._value);

        kubeLabelDocumentPoint.tag('uid', kubeLabelsInfluxRow.uid);

        kubeLabelDocumentPoint.tag('businessID', kubeLabelsInfluxRow.businessID);
        kubeLabelDocumentPoint.tag('__name__', kubeLabelsInfluxRow.__name__);
        kubeLabelDocumentPoint.tag('pod', kubeLabelsInfluxRow.pod);
        kubeLabelDocumentPoint.tag('namespace', kubeLabelsInfluxRow.namespace);

        kubeLabelsInfluxRow.labels.forEach(({ name, value }) => {
            kubeLabelDocumentPoint.tag(name, value);
        });

        return [kubeLabelDocumentPoint];
    }
}
