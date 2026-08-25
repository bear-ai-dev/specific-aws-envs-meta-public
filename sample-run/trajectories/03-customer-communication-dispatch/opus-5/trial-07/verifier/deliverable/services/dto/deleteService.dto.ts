import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiHideProperty } from '@nestjs/swagger';

export class DeleteServiceDTO {
    @IsString()
    @IsNotEmpty()
    @IsOptional()
    @ApiHideProperty()
    public businessID: string;

    @IsString()
    @IsNotEmpty()
    public serviceId: string;
}
