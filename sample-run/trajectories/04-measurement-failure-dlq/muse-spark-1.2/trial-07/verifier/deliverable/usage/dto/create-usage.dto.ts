import { OmitType } from '@nestjs/swagger';
import { CreateStandardMeasurementDto } from '../../measurement-config/dto/create-standard-measurement.dto.js';

export class CreateUsageDto extends CreateStandardMeasurementDto {
    public declare dimensionId: string;
}

export class UsageForCustomerEnrollment extends OmitType(CreateUsageDto, ['customerId', 'timestamp'] as const) {}
