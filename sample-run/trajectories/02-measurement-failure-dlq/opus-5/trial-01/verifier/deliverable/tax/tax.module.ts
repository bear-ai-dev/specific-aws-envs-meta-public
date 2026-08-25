import { forwardRef, Module } from '@nestjs/common';
import { TaxService } from './tax.service.js';
import { PrivateAPISettingsModule } from '../setting/settings.module.js';

@Module({
    providers: [TaxService],
    imports: [PrivateAPISettingsModule],
    exports: [TaxService],
})
export class TaxModule {}
