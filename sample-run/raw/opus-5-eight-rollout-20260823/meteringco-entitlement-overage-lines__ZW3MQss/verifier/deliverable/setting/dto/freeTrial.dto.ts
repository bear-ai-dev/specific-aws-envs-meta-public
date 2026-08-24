import { IsEnum, IsNotEmpty, IsNumber, IsString, ValidationArguments } from 'class-validator';
import { FreeTrialStatus } from './FreeTrialStatus.js';

export class FreeTrialDto {
    @IsNotEmpty()
    @IsString()
    public businessID: string;

    @IsNumber()
    @IsNotEmpty()
    public expireTime: number;
    @IsEnum(FreeTrialStatus, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `freeTrialStatus: The value ${value} is not a valid value for the freeTrialStatus field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    public freeTrialStatus: FreeTrialStatus;
}
