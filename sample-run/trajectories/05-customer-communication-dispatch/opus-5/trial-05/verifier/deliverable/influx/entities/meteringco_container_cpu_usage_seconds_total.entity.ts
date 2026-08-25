import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class MeteringCoContainerCpuUsageSecondsTotal extends BaseInfluxTable {
    /**
     *
     * The unique Id for a pod
     * @example "ebs-csi-node-xs8cb"
     * @example "meteringco-agent"
     */
    public pod: string;

    public declare _value: number;
}
