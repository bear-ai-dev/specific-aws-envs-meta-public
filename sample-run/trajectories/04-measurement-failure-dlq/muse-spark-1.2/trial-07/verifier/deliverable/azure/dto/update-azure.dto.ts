import { PartialType } from '@nestjs/swagger';
import { CreateAzureDto } from './create-azure.dto.js';

export class UpdateAzureDto extends PartialType(CreateAzureDto) {}
