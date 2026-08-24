import { Controller, Get, NotFoundException, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CostService } from './cost.service.js';
import { Request } from 'express';
import { FindCostResponse } from './dto/cost.dto.js';

@ApiTags('Analytics')
@Controller('analytics')
export class CostController {
    constructor(private readonly costService: CostService) {}

    /**
     * Find Cost for Block Storage
     */
    @ApiOkResponse({
        status: 200,
        description: 'Contains cost data for Block Storage',
        type: FindCostResponse,
    })
    @ApiNotFoundResponse({
        status: 404,
        description: 'If No data is found a 404 will be returned',
        type: NotFoundException,
    })
    @ApiOperation({ operationId: 'Get Cost for Block Storage' })
    @UseGuards(AuthGuard('jwt'))
    @Get('cost/storage')
    findCostStorage(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.costService.findAggregateCost({ businessID });
    }

    /**
     * Find Cost for Compute
     */
    @ApiOkResponse({
        status: 200,
        description: 'Contains cost data for Compute',
        type: FindCostResponse,
    })
    @ApiNotFoundResponse({
        status: 404,
        description: 'If No data is found a 404 will be returned',
        type: NotFoundException,
    })
    @ApiOperation({ operationId: 'Get Cost for Compute' })
    @UseGuards(AuthGuard('jwt'))
    @Get('cost/compute')
    findCostCompute(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.costService.findCostCompute({ businessID });
    }
}
