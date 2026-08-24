import { PartialType } from '@nestjs/swagger';
import { CreateAnalyticsDto } from './create-analytics.dto.js';

export class UpdateAnalyticsDto extends PartialType(CreateAnalyticsDto) {}
