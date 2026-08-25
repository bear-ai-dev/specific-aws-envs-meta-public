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
}
