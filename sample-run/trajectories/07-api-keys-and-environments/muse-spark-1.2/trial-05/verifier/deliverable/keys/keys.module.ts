import { Module, forwardRef } from '@nestjs/common';
import { KeysController } from './keys.controller.js';
import { KeysService } from './keys.service.js';
import { InfluxModule } from '../influx/influx.module.js';

@Module({
    controllers: [KeysController],
    providers: [KeysService],
    imports: [forwardRef(() => InfluxModule)],
    exports: [KeysService],
})
export class KeysModule {}
