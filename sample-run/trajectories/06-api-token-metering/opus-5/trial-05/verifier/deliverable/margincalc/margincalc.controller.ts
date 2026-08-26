import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { MargincalcService } from './margincalc.service.js';
import { CreateMargincalcDto } from './dto/createMarginCalc.dto.js';

import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetCostDto } from './dto/getCost.dto.js';
@ApiBearerAuth('bearer')
@Controller('margincalc')
@ApiTags('Cost and Profit')
export class MargincalcController {
    constructor(private readonly margincalcService: MargincalcService) {}

    @ApiOperation({ operationId: 'Real time cost Calculation' })
    @UseGuards(AuthGuard('jwt'))
    @Post()
    create(@Body() createMargincalcDto: CreateMargincalcDto) {
        return this.margincalcService.create(createMargincalcDto);
    }
    @ApiOperation({ operationId: 'Find Cost for Infra' })
    @UseGuards(AuthGuard('jwt'))
    @Post('cost')
    calculateCost(@Body() discoveredEntities: GetCostDto) {
        return this.margincalcService.calculateCost(discoveredEntities);
    }
}
