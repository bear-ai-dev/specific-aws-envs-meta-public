import { IsArray, IsOptional } from 'class-validator';

export class UpdateOrganizationDto {
    public businessID: string;
    public subject: string;
    @IsArray()
    @IsOptional()
    public emails?: Array<string>;
}
