import { IsOptional, ValidateNested } from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PortalPages } from '../../setting/dto/update-settings.dto.js';

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
    @Type(() => PortalPages)
    @ValidateNested({ each: true })
    pages?: PortalPages;
    @ApiHideProperty()
    @IsOptional()
    businessID: string;
    @ApiHideProperty()
    @IsOptional()
    subject: string;
}
