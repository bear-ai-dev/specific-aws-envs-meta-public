import { IsNotEmpty, IsString, IsISO8601 } from 'class-validator';
import { CreateMeasurementDto } from './createMeasurement.dto.js';

export class ReadMeasurementDTO {
    @IsString()
    @IsNotEmpty()
    public infrastructureType: string;

    @IsString()
    @IsNotEmpty()
    public businessID: string;

    @IsString()
    @IsISO8601()
    @IsNotEmpty()
    public startTime: string;

    @IsString()
    @IsISO8601()
    @IsNotEmpty()
    public endTime: string;

    static getMeasurmentDTO(dbModel: Array<any>): Array<CreateMeasurementDto> {
        return dbModel.map((element) => new CreateMeasurementDto(element));
    }
}
