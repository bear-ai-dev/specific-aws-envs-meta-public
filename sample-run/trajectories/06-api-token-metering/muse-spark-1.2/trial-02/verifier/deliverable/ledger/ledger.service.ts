import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ReadLedgerDto } from './dto/readLedger.dto';
import { DatetimeUtils } from '../utils/datetime';
import { InfluxService } from '../influx/influx.service';
import { LedgerEntity } from './entities/ledger.entity';
@Injectable()
export class LedgerService {
    constructor(@Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService) {}
    async findLedgerByType(readLedgerDto: ReadLedgerDto): Promise<LedgerEntity> {
        const { startDate, endDate, type, businessID, filters, orFilters, uniqueFilters, groupBy, notExistsFilters } =
            readLedgerDto;
        const start = startDate ? new Date(startDate) : DatetimeUtils.firstDayOfLastMonth();
        const end = endDate ? new Date(endDate) : DatetimeUtils.lastDayOfLastMonth();
        const influxRows = await this.influxService.queryForLedger({
            start,
            end,
            measurement: LedgerEntity.typeToMeasurement(type),
            businessID,
            filters,
            orFilters,
            uniqueFilters,
            groupBy,
            notExistsFilters,
        });
        const ledger = new LedgerEntity({ type, influxRows });
        return ledger;
    }
}
