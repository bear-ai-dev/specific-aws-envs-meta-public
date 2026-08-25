import { ReadCustomerResponseData } from '../../customer/entities/customer.entity.js';

export class UsageDocument {
    public value: string;

    public units?: string;

    public usageName?: string;

    public startTime?: string;
    public endTime?: string;
    public metadataGroup?: Record<string, string>;

    constructor({ value, units, usageName, startTime, endTime, metadataGroup }: UsageDocument) {
        this.value = value;
        this.units = units;
        this.usageName = usageName;
        this.startTime = startTime;
        this.endTime = endTime;
        if (metadataGroup) {
            this.metadataGroup = metadataGroup;
        }
    }
}

export class ReadUsageForCustomerDto {
    public customerId: string;
    public businessID: string;
    public customer?: ReadCustomerResponseData;
}
