import { Controller, Get, Post, Body, Patch, Param, Delete, Headers, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AgentMeasurementService } from './agent-measurement.service.js';
import { CreateAgentMeasurementDto } from './dto/create-agent-measurement.dto.js';
import { UpdateAgentMeasurementDto } from './dto/update-agent-measurement.dto.js';

@Controller('agent-measurement')
export class AgentMeasurementController {
    constructor(private readonly agentMeasurementService: AgentMeasurementService) {}

    @UseGuards(AuthGuard('jwt'))
    @Post()
    create(@Body() createAgentMeasurementDto) {
        return this.agentMeasurementService.create(createAgentMeasurementDto);
    }
}
