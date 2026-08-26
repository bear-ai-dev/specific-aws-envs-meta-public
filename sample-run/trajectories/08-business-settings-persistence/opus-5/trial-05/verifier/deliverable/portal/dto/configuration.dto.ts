import { IsOptional, ValidateNested } from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PortalPages, PortalPagesDto } from '../../setting/dto/update-settings.dto.js';

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
    @Type(() => PortalPagesDto)
    @ValidateNested({ each: true })
    pages?: PortalPagesDto;
    @ApiHideProperty()
    @IsOptional()
    businessID: string;
    @ApiHideProperty()
    @IsOptional()
    subject: string;
}
