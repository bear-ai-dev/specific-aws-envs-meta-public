import { IsNotEmpty, IsObject, IsOptional, IsString, IsISO8601 } from 'class-validator';

export class CreateMeasurementDto {
    @IsNotEmpty()
    public measurementValue: string | number;

    @IsString()
    @IsNotEmpty()
    public infrastructureType: string;

    @IsString()
    @IsNotEmpty()
    public meteringcoID: string;

    @IsObject()
    @IsOptional()
    public measurementMetaData: any;

    @IsString()
    @IsNotEmpty()
    public measurementType: any;

    @IsString()
    public businessID: string;

    @IsOptional()
    @IsISO8601()
    public time: string;

    constructor(
        dbMeasurementEntity = {
            _start: '',
            _stop: '',
            _time: null,
            _field: '',
            _value: '',
            serviceId: '',
            measurementType: '',
            _measurement: '',
            businessID: '',
            result: '',
            table: '',
        },
    ) {
        // TODO Custom validation based on dimension
        const {
            _measurement,
            _start,
            _stop,
            _time,
            result,
            table,
            _field,
            _value,
            serviceId,
            measurementType,
            businessID,
            ...rest
        } = dbMeasurementEntity;
        this.measurementValue = _value;
        this.infrastructureType = _field;
        this.measurementMetaData = rest;
        this.meteringcoID = serviceId;
        this.measurementType = measurementType;
        this.businessID = businessID;
        this.time = _time;
    }
}
