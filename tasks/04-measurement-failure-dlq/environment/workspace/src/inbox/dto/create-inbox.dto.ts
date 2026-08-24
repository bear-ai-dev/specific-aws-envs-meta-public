import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { InboxLevel, IsArchived } from '../entities/inbox.entity.js';

export class CreateInboxDto {
    @IsString()
    @IsNotEmpty()
    public title: string;

    @IsString()
    @IsOptional()
    public description?: string;

    @ApiProperty({
        enum: InboxLevel,
    })
    @IsEnum(InboxLevel)
    @IsOptional()
    public level?: InboxLevel;

    @ApiProperty({
        enum: IsArchived,
    })
    @IsEnum(IsArchived)
    @IsOptional()
    public isArchived?: IsArchived;

    @IsDateString()
    @IsOptional()
    public messageReceivedDate?: string;

    @IsString()
    @IsOptional()
    @ApiHideProperty()
    public businessID: string;
}

export class CreateResponseDto extends BasicResponseDTO {
    @ApiProperty({
        type: String,
        isArray: true,
    })
    data: Array<{ inboxId: string }>;
}
