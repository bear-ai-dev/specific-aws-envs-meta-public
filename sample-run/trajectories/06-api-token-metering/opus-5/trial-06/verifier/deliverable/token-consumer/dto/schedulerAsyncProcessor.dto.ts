import { TokenConsumerAsyncProcessor } from '../token-consumer-async-processor';

export class TokenAsyncProcessorDto {
    public businessID: string;
    public subject: string;
    public dimensionType = TokenConsumerAsyncProcessor.processorName;
}

export class TokenAsyncAggregatorDto {
    public businessID: string;
    public subject: string;
    public dimensionType = TokenConsumerAsyncProcessor.aggregationProcessor;
    public startDate?: string;
    public endDate?: string;
    /**
     * The meteringco customer whose registered api calls are closed. Resolved from the businessID when it is
     * not handed over with the job.
     */
    public customerId?: string;
    public saasCustomerAssociatedBusinessID?: string;
}
