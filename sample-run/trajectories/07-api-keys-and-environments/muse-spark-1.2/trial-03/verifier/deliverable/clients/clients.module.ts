import { Module, forwardRef } from '@nestjs/common';
import { InfluxModule } from '../influx/influx.module.js';
import { UsersModule } from '../users/users.module.js';
import { ClientsService } from './clients.service.js';
import { ClientsController, ApiKeysController, KeysController, CredentialsController, UsersKeysController, UsersClientsController, UsersApiKeysController, UsersCredentialsController, ApiClientsController, ApiApiKeysController } from './clients.controller.js';

@Module({
    imports: [forwardRef(() => InfluxModule), forwardRef(() => UsersModule)],
    controllers: [ClientsController, ApiKeysController, KeysController, CredentialsController, UsersKeysController, UsersClientsController, UsersApiKeysController, UsersCredentialsController, ApiClientsController, ApiApiKeysController],
    providers: [ClientsService],
    exports: [ClientsService],
})
export class ClientsModule {}
