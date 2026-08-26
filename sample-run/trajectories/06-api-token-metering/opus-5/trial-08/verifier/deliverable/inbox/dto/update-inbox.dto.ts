import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsOptional } from 'class-validator';
import { IsArchived } from '../entities/inbox.entity.js';

export class UpdateInboxDto {
    @ApiProperty({
        enum: IsArchived,
    })
    @IsEnum(IsArchived)
    @IsOptional()
    public isArchived?: IsArchived;

    @IsString()
    @IsOptional()
    @ApiHideProperty()
    public businessID: string;

    @IsString()
    @IsOptional()
    @ApiHideProperty()
    public inboxId?: string;
}
