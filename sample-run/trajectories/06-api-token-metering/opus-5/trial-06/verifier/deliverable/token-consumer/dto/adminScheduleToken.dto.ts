import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AdminScheduleTokenDto {
    @IsString()
    @IsNotEmpty()
    public businessID: string;
    public subject: string;
}

export class AdminAggregateTokenDto extends AdminScheduleTokenDto {
    /**
     * Start of the metering period which should be closed. Defaults to six hours before the end date.
     */
    @IsOptional()
    @IsDateString()
    public startDate?: string;

    /**
     * End of the metering period which should be closed. Defaults to now.
     */
    @IsOptional()
    @IsDateString()
    public endDate?: string;
}
