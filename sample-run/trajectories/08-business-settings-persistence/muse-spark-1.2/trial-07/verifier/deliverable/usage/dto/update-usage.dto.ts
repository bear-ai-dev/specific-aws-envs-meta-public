import { PartialType } from '@nestjs/swagger';
import { CreateUsageDto } from './create-usage.dto.js';

export class UpdateUsageDto extends PartialType(CreateUsageDto) {}
