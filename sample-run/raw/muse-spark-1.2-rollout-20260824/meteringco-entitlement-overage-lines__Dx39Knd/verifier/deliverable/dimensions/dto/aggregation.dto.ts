import { SupportedMeasurementFrequencies } from '../../scheduler/dto/scheduler.dto.js';
import { aggregationType } from '../entities/dimensions.entity.js';
import { aggregationInterval, aggregationMethod } from './create-dimension.dto.js';
import { ReadDimensionDto } from './read-dimension.dto.js';

/**
 * The aggregation dto is used for the schedulued aggregation jobs associated with dimension creation
 * They take the following params
 * @param dimensionId The dimensionId of the dimension to be aggregated - the Id which uniquely defines a dimension
 * @param businessID The businessID of the dimension to be aggregated - uniqueId for a business in meteringco
 * @param rate The rate at which the dimension should be aggregated - this is used to determine roughly how long it has been since the last aggregation in order to lookback for data
 * @param aggregationType The type of aggregation to be performed - this is used to determine which aggregation function to use EX: podUpTime | ebsSnapshot | ebsVolume
 */
export class AggregationDto {
    public dimensionId: ReadDimensionDto['dimensionId'];
    public businessID: string;
    public rate: SupportedMeasurementFrequencies;
    public aggregationType?: aggregationType;
}
