import {
    Controller,
    Post,
    Body,
    UseGuards,
    Req,
    NotFoundException,
    Get,
    Param,
    Put,
    Delete,
    UseInterceptors,
} from '@nestjs/common';
import { MeasurementConfigService } from './measurement-config.service.js';
import {
    CreateMeasurementConfigDto,
    CreateMeasurementConfigurationResponse,
} from './dto/create-measurement-config.dto.js';
import { AuthGuard } from '@nestjs/passport';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiExtraModels,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import {
    DatastoreAccessInformationResponse,
    MeasurementResponseEntityEnricher,
    ReadMeasurementConfigResponse,
} from './dto/read-measurement-config.dto.js';
import {
    UpdateAgentAccessInformation,
    UpdateDatastoreAccessInformation,
    UpdateInfrastructureAccessInformation,
    UpdateMeasurementConfigDto,
} from './dto/update-measurement-config.dto.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import {
    AgentAccessInformation,
    DatastoreAccessInformation,
    InfrastructureAccessInformation,
} from './entities/measurement-config.entity.js';
import { DeleteMeasurementConfigResponse } from './dto/delete-measurement-config.dto.js';
import { KafkaDeploymentParametersDto } from '../kubernetes-deployer/entities/kafkaConsumer/kafkaDeploymentParametersDto.js';
import { TokenRegisterInterceptor } from '../interceptors/tokenRegisterInterceptor.js';

@ApiExtraModels(InfrastructureAccessInformation)
@ApiExtraModels(AgentAccessInformation)
@ApiExtraModels(DatastoreAccessInformation)
@ApiExtraModels(MeasurementResponseEntityEnricher)
@ApiExtraModels(UpdateAgentAccessInformation)
@ApiExtraModels(UpdateInfrastructureAccessInformation)
@ApiExtraModels(DatastoreAccessInformationResponse)
@ApiExtraModels(UpdateDatastoreAccessInformation)
@ApiExtraModels(KafkaDeploymentParametersDto)
@ApiBearerAuth('bearer')
@Controller('measurements')
@ApiTags('Measurements')
export class MeasurementConfigController {
    constructor(private readonly measurementConfigService: MeasurementConfigService) {}

    /**
     * List all measurements created
     */
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ReadMeasurementConfigResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiOperation({ operationId: 'Get all measurements' })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Get()
    findAll(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.measurementConfigService.findAll({ businessID });
    }

    /**
     * Find a measurement
     */
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ReadMeasurementConfigResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse({
        status: 404,
        description: 'Measurement Not Found',
        schema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The error message',
                    example: 'Measurement with ID: 807867e0-26ca-4831-846b-a670224db055 not found',
                },
                error: {
                    type: 'string',
                    description: 'The error name',
                    example: 'Not Found',
                },
                statusCode: {
                    type: 'number',
                    description: 'The HTTP status code',
                    example: 404,
                    externalDocs: {
                        description: 'MDN Documentation Reference',
                        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404',
                    },
                },
            },
            example: {
                message: 'Measurement with ID: 807867e0-26ca-4831-846b-a670224db055 not found',
                error: 'Not Found',
                statusCode: 404,
            },
            required: ['message', 'error', 'statusCode'],
        },
    })
    @ApiOperation({ operationId: 'Get a measurement by ID' })
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `a65ae317-e940-44cc-b570-cc74d1897c36`',
        name: 'measurementId',
        type: 'string',
        required: true,
    })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Get(':measurementId')
    findOne(@Param('measurementId') measurementId: string, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.measurementConfigService.findOne({ businessID, measurementId });
    }

    /**
     * Create a measurement
     *
     */
    @ApiCreatedResponse({
        status: 201,
        description: 'Measurement Created',
        type: CreateMeasurementConfigurationResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiOperation({ operationId: 'Create a measurement' })
    @UseGuards(AuthGuard('jwt'))
    @Post()
    create(@Body() createMeasurementConfigDto: CreateMeasurementConfigDto, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID, sub: subject } = request.user;
        return this.measurementConfigService.create({ ...createMeasurementConfigDto, businessID }, subject);
    }

    /**
     * Update a measurement
     */
    @ApiOkResponse({
        status: 200,
        description: 'Measurement Updated',
        type: CreateMeasurementConfigurationResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse({
        status: 404,
        description: 'Measurement Not Found',
        schema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The error message',
                    example: 'Measurement with ID: 807867e0-26ca-4831-846b-a670224db055 not found',
                },
                error: {
                    type: 'string',
                    description: 'The error name',
                    example: 'Not Found',
                },
                statusCode: {
                    type: 'number',
                    description: 'The HTTP status code',
                    example: 404,
                    externalDocs: {
                        description: 'MDN Documentation Reference',
                        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404',
                    },
                },
            },
            example: {
                message: 'Measurement with ID: 807867e0-26ca-4831-846b-a670224db055 not found',
                error: 'Not Found',
                statusCode: 404,
            },
            required: ['message', 'error', 'statusCode'],
        },
    })
    @ApiOperation({ operationId: 'Update a measurement' })
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `a65ae317-e940-44cc-b570-cc74d1897c36`',
        name: 'measurementId',
        type: 'string',
        required: true,
    })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Put(':measurementId')
    update(
        @Param('measurementId') measurementId: string,
        @Body() params: UpdateMeasurementConfigDto,
        @Req() request: Request,
    ) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID, sub: subject } = request.user;
        return this.measurementConfigService.update(
            {
                ...params,
                measurementId,
                businessID,
            },
            subject,
        );
    }
    /**
     * Delete a measurement
     */
    @ApiOkResponse({
        status: 200,
        description: 'Measurement deleted',
        type: DeleteMeasurementConfigResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse({
        status: 404,
        description: 'Measurement Not Found',
        schema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The error message',
                    example: 'Measurement with ID: 807867e0-26ca-4831-846b-a670224db055 not found',
                },
                error: {
                    type: 'string',
                    description: 'The error name',
                    example: 'Not Found',
                },
                statusCode: {
                    type: 'number',
                    description: 'The HTTP status code',
                    example: 404,
                    externalDocs: {
                        description: 'MDN Documentation Reference',
                        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404',
                    },
                },
            },
            example: {
                message: 'Measurement with ID: 807867e0-26ca-4831-846b-a670224db055 not found',
                error: 'Not Found',
                statusCode: 404,
            },
            required: ['message', 'error', 'statusCode'],
        },
    })
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `a65ae317-e940-44cc-b570-cc74d1897c36`',
        name: 'measurementId',
        type: 'string',
        required: true,
    })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Delete(':measurementId')
    @ApiOperation({ operationId: 'Delete a measurement' })
    delete(@Param('measurementId') measurementId, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.measurementConfigService.remove({ measurementId, businessID });
    }
}
