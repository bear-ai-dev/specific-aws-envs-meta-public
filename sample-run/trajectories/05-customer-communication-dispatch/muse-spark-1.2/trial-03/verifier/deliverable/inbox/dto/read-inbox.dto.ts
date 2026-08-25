import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReadInboxDto {
    public businessID: string;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    public inboxId?: string;
}
