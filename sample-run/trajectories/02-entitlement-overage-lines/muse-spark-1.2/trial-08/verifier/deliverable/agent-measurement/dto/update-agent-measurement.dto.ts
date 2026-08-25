import { PartialType } from '@nestjs/swagger';
import { CreateAgentMeasurementDto } from './create-agent-measurement.dto.js';

export class UpdateAgentMeasurementDto extends PartialType(CreateAgentMeasurementDto) {}
