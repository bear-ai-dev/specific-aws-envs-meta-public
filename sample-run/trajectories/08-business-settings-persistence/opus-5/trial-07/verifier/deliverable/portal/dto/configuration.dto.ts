import { IsOptional, ValidateNested } from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PortalPages, PortalPagesUpdate } from '../../setting/dto/update-settings.dto.js';

export class ConfigurationResponse extends BasicResponseDTO {
    @ApiProperty({
        name: 'logoUrl',
        description: 'SaaS business log url',
    })
    public logoUrl: string;

    @ApiProperty({
        name: 'Pages Configuration',
        description: 'Pages Configuration',
    })
    pages: PortalPages;
}

export class PortalPagesConfigurationDto {
    @IsOptional()
    @Type(() => PortalPagesUpdate)
    @ValidateNested({ each: true })
    @ApiProperty({ type: PortalPagesUpdate, required: false })
    pages?: PortalPagesUpdate;
    @ApiHideProperty()
    @IsOptional()
    businessID: string;
    @ApiHideProperty()
    @IsOptional()
    subject: string;
}
