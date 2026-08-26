import { Module, forwardRef } from '@nestjs/common';
import { InfluxModule } from '../influx/influx.module.js';
import { UsersModule } from '../users/users.module.js';
import { KeysController } from './keys.controller.js';
import { KeysService } from './keys.service.js';

@Module({
    controllers: [KeysController],
    providers: [KeysService],
    imports: [forwardRef(() => InfluxModule), forwardRef(() => UsersModule)],
    exports: [KeysService],
})
export class KeysModule {}
