import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { MeasurementService } from './measurement.service.js';
import { CreateMeasurementDto } from './dto/createMeasurement.dto.js';
import { CreateCustomPodMeasurement } from './dto/customPodMeasurement.dto.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
@ApiBearerAuth('bearer')
@Controller('measurements/api')
@ApiTags('Measurement')
export class MeasurementController {
    constructor(private readonly measurementService: MeasurementService) {}

    @UseGuards(AuthGuard('jwt'))
    @Post()
    create(@Body() createMeasurementDto: CreateMeasurementDto, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.measurementService.create({ ...createMeasurementDto, businessID });
    }

    @UseGuards(AuthGuard('jwt'))
    @Post('/podStart')
    createPodStart(@Body() customPodStart: CreateCustomPodMeasurement, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        const { time, metadataLabels, podID } = customPodStart;
        const input = {
            measurementValue: time ? new Date(time).getTime() : new Date().getTime(),
            infrastructureType: 'manual_pod_start_time',
            measurementMetaData: {
                pod: podID,
                ...metadataLabels,
                __name__: 'manual_pod_start_time',
            },
            measurementType: 'number',
            time: new Date().getTime().toString(),
            meteringcoID: '',
            businessID,
        };
        return this.measurementService.create(input);
    }
    @UseGuards(AuthGuard('jwt'))
    @Post('/podEnd')
    createPodEnd(@Body() customPodEnd: CreateCustomPodMeasurement, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        const { time, metadataLabels, podID } = customPodEnd;
        const input = {
            measurementValue: time ? new Date(time).getTime() : new Date().getTime(),
            infrastructureType: 'manual_pod_end_time',
            measurementMetaData: {
                pod: podID,
                ...metadataLabels,
                __name__: 'manual_pod_end_time',
            },
            measurementType: 'number',
            time: new Date().getTime().toString(),
            meteringcoID: '',
            businessID,
        };
        return this.measurementService.create(input);
    }
}
