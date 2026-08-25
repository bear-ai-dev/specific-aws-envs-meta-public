import { PickType } from '@nestjs/swagger';
import { QueryParamUsageDto } from '../../customer/dto/read-customer.dto';

export class PortalUsageQueryParamDto extends PickType(QueryParamUsageDto, ['aggregationPurpose'] as const) {}
