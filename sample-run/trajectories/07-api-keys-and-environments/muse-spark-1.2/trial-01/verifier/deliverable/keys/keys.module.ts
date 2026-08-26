import { Module, forwardRef } from '@nestjs/common';
import { KeysService } from './keys.service.js';
import { KeysController, ApiKeysAliasController, ClientsAliasController, CredentialsAliasController, UsersKeysAliasController } from './keys.controller.js';
import { InfluxModule } from '../influx/influx.module.js';

@Module({
    controllers: [KeysController, ApiKeysAliasController, ClientsAliasController, CredentialsAliasController, UsersKeysAliasController],
    providers: [KeysService],
    imports: [forwardRef(() => InfluxModule)],
    exports: [KeysService],
})
export class KeysModule {}
