import { IsNotEmpty, IsString } from 'class-validator';

export class AdminScheduleTokenDto {
    @IsString()
    @IsNotEmpty()
    public businessID: string;
    public subject: string;
}
