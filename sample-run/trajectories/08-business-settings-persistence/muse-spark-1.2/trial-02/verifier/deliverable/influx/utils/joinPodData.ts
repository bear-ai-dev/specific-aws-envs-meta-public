export const joinedResults = (
    pods: Array<{
        table: string;
        _value: any;
        pod: string;
        _measurement: string;
        label_meteringco_customer_id?: string;
    }>,
    delimeterForApplicationIDServiceIDMap?: string,
): Record<string, any> => {
    return pods.reduce((acc, { table, _value, pod, _measurement, ...rest }) => {
        // Join pods with their labels, this done outside of influx for now
        if (!acc[pod]) {
            acc[pod] = {};
        }
        if (_measurement === 'meteringco_kube_pod_labels') {
            const { label_meteringco_customer_id } = rest;
            if (label_meteringco_customer_id) {
                acc[pod] = { ...acc[pod], customerId: label_meteringco_customer_id };
            }
        }
        if (_measurement === 'meteringco_kube_pod_container_status_running') {
            acc[pod] = { ...acc[pod], usage: _value, ...rest };
        }
        return acc;
    }, {});
};
