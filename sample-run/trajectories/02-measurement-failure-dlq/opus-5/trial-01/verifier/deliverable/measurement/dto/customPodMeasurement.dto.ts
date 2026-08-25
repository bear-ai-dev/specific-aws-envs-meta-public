import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCustomPodMeasurement {
    /**
     * The ID associated with the POD, this must be the same as the pod inside the kubernetes cluster in order to join on data which is collected.
     * @example aws-node-hrjz5
     * @example mayabackend-59cb6cccbf-4sxm9
     *
     */
    @IsString()
    @IsNotEmpty()
    public podID: string;

    /**
     * The UNIX time assocaited with the metric optional. If not included, the current time of the request will be used.
     * @example 1659135683
     *
     */
    @IsOptional()
    public time?: string;
    /**
     * metadata lables to associate with the metric itself. Not required for any /discover filter queries
     * @example { "label_controller_revision_hash": "5fcbd59b8b", "foo": 123}
     *
     */
    @IsOptional()
    public metadataLabels?: object;
}
