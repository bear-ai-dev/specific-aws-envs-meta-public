import { Point } from '@influxdata/influxdb-client';
import { FreeTrialInfluxRow } from '../../influx/entities/freeTrialInfluxRow.js';
import { InfluxService } from '../../influx/influx.service.js';
import { FreeTrialStatus } from '../dto/FreeTrialStatus.js';

export class FreeTrialEntity {
    public static readonly _measurement = 'FreeTrial';
    public freeTrialStatus?: FreeTrialStatus;
    public expireTime?: number;
    public businessID: string;
    constructor({ expireTime, freeTrialStatus = FreeTrialStatus.none, businessID }: FreeTrialEntity) {
        this.freeTrialStatus = freeTrialStatus;
        this.expireTime = expireTime;
        this.businessID = businessID;
    }

    static transformer(freeTrial: FreeTrialEntity, influxService: InfluxService): Point[] {
        const freeTrialPoint = influxService.getPoint(FreeTrialEntity._measurement);

        const { businessID } = freeTrial;

        freeTrialPoint.tag('businessID', businessID);
        if (freeTrial.expireTime) {
            freeTrialPoint.floatField('expireTime', freeTrial.expireTime);
        }
        freeTrialPoint.tag('freeTrialStatus', freeTrial.freeTrialStatus);

        // All Entity Transformers should return an array of points, keep logic consistent, even if there is only one element
        return [freeTrialPoint];
    }

    static dbModelToEntity(dbModel: FreeTrialInfluxRow): FreeTrialEntity {
        const { _value, freeTrialStatus, businessID } = dbModel;
        return new FreeTrialEntity({ expireTime: _value, freeTrialStatus, businessID });
    }
    static determineIfExpired(freeTrialEntity: FreeTrialEntity): FreeTrialEntity {
        const { expireTime, freeTrialStatus } = freeTrialEntity;
        if (freeTrialStatus === FreeTrialStatus.none) {
            return freeTrialEntity;
        }
        if (freeTrialStatus === FreeTrialStatus.expired) {
            return freeTrialEntity;
        }
        if (freeTrialStatus === FreeTrialStatus.live) {
            return freeTrialEntity;
        }
        if (freeTrialStatus === FreeTrialStatus.valid) {
            if (expireTime && expireTime < Date.now()) {
                return new FreeTrialEntity({
                    expireTime,
                    freeTrialStatus: FreeTrialStatus.expired,
                    businessID: freeTrialEntity.businessID,
                });
            }
            return freeTrialEntity;
        }
    }
}
