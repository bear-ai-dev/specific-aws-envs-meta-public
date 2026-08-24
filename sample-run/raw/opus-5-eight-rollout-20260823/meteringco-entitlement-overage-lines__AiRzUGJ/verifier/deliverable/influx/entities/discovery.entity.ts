import { Logger } from '@nestjs/common';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { AwsServices } from '../../margincalc/dto/createMarginCalc.dto.js';

/**
 *
 * This class represents a unit of infrastructure and its associated usage for a given date time period.
 * It doesn't need a Service ID and is independent of a Service. Although a User may put a ServiceID on a discovered service for grouping purposes
 *
 */
export class DiscoveryServiceEntity {
    private static readonly logger = new Logger(DiscoveryServiceEntity.name);
    /**
     * BusinessID used for lookup, Unique ID for business MeteringCo
     * @example myCoolCorp
     * @example 123Bend980
     * */
    @IsString()
    @IsNotEmpty()
    public businessID: string;

    /**
     * ID for the specific infrastructure unit as it appears in SaaS account, can be PodID or EC2 instance ID depending on the type of infrastructure
     * @example i-239840adbde
     * @example k8s_pod_my_cool_pod_akjhasklfja_1243
     * */
    @IsString()
    @IsNotEmpty()
    public ID: string;

    /**
     * Unix time for when the infrastructure was started, can be before the billing period
     * @example 1658097518
     * */
    @IsNumber()
    @IsNotEmpty()
    public startTime: string;

    /**
     * Number seconds the CPU was used for
     *  @example 400
     *
     * */

    @IsNumber()
    @IsOptional()
    public cpuSeconds: number;

    /**
     * Number memory bytes Used during the requested period of time
     *  @example 1547936
     *
     * */
    @IsNumber()
    @IsOptional()
    public memoraryBytes: number;

    /**
     * Amount of data transfer bytes sent to the infrastructure
     *  @example 123248587
     *
     * */
    @IsNumber()
    @IsOptional()
    public dataTransferBytesRecieved: number;

    /**
     * Amount of data transfer transmitted from the infrastructure, egress from the infrastructure.
     *  @example 159845324
     *
     * */
    @IsNumber()
    @IsOptional()
    public dataTransferBytesTransmitted: number;

    /**
     * Infrastructure type the component was running on
     *  @example t3-medium
     *
     * */
    @IsString()
    @IsOptional()
    public infrastructureType: string;

    /**
     * specific service name of infrastructure
     *  @example EC2
     *
     * */
    @IsString()
    @IsOptional()
    public serviceType: AwsServices;

    /**
     * Infrastructure type the component was running on
     *  @example Linux/UNIX
     *
     * */
    @IsString()
    @IsOptional()
    public hostOperatingSystem: string;

    /**
     * region the pod was ran in
     *  @example  us-east-1
     *
     * */
    @IsString()
    @IsOptional()
    public region: string;

    /**
     *  unix time in seconds the pod completed execution
     *  @example  123456789
     *
     * */
    @IsString()
    @IsOptional()
    public podCompletionTimeInSeconds: string;

    /**
     * unix time in seconds pod started execution
     *  @example  123456788
     *
     * */
    @IsString()
    @IsOptional()
    public podStartTimeInSeconds: string;

    /**
     * The cloud env that ran the cluster
     *  @example aws
     *
     * */
    @IsNumber()
    @IsOptional()
    public cloudEnviornment: string;

    /**
     * Metadata associated with the infrastructure
     *  @example {"myCoolKey": "anAwesomeValue", "arrayOffields": ["1", "another"]}
     *
     * */
    @IsOptional()
    public metadata: Record<string, string | number | Array<any>>;

    /**
     * Overides manually recorded by the custoemr
     *  @example {"myCoolKey": "anAwesomeValue", "arrayOffields": ["1", "another"]}
     *
     * */
    @IsOptional()
    public manualOverrides: Record<string, string | number | Array<any>>;

    /**
     * Overides manually recorded by the custoemr
     *  @example {"myCoolKey": "anAwesomeValue", "arrayOffields": ["1", "another"]}
     *
     * */
    @IsOptional()
    public podDeletetionTime: string;

    constructor({
        businessID,
        ID,
        cpuSeconds,
        memoraryBytes,
        dataTransferBytesRecieved,
        dataTransferBytesTransmitted,
        metadata,
        serviceType,
        infrastructureType,
        region,
        cloudEnviornment,
        hostOperatingSystem,
        podCompletionTimeInSeconds,
        podStartTimeInSeconds,
        manualOverrides,
        podDeletetionTime,
    }) {
        this.businessID = businessID;
        this.ID = ID;
        this.cpuSeconds = cpuSeconds;
        this.memoraryBytes = memoraryBytes;
        this.dataTransferBytesRecieved = dataTransferBytesRecieved;
        this.dataTransferBytesTransmitted = dataTransferBytesTransmitted;
        this.metadata = metadata;
        this.serviceType = serviceType;
        this.infrastructureType = infrastructureType;
        this.region = region;
        this.cloudEnviornment = cloudEnviornment;
        this.hostOperatingSystem = hostOperatingSystem;
        this.podCompletionTimeInSeconds = podCompletionTimeInSeconds;
        this.podStartTimeInSeconds = podStartTimeInSeconds;
        this.manualOverrides = manualOverrides;
        this.podDeletetionTime = podDeletetionTime;
    }
}
