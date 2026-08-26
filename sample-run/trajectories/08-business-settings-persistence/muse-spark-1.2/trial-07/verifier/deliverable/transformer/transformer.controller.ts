import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { TransformerService } from './transformer.service.js';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
@Controller()
@ApiTags('Transformer')
export class TrasformerController {
    constructor(private readonly transformerService: TransformerService) {}

    @UseGuards(AuthGuard('jwt'))
    @Post()
    async recieveAgentMeasurement(@Req() request: Request) {
        return this.transformerService.recieveAgentMeasurement(request);
    }
}
