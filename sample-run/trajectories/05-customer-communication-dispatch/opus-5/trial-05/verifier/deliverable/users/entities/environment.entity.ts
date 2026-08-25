import { Point } from '@influxdata/influxdb-client';
import { UserActiveEnvironment } from '../../influx/entities/userTable.entity.js';
import { InfluxService } from '../../influx/influx.service.js';
import { Environment } from '../dto/Environment.js';

export class EnvironmentEntity {
    public static _measurement = 'UserActiveEnvironment';
    public subject: string;
    public environment: Environment;

    constructor({ subject, environment }: { subject: string; environment?: Environment }) {
        this.subject = subject;
        this.environment = environment ? environment : Environment.PRODUCTION;
    }

    public static transformer(entity: EnvironmentEntity, influxService: InfluxService): Array<Point> {
        const userPoint = influxService.getPoint(EnvironmentEntity._measurement);
        userPoint.tag('subject', entity.subject);
        userPoint.stringField('environment', entity.environment);
        return [userPoint];
    }

    static dbModelToEntity(dbModel: UserActiveEnvironment) {
        return new EnvironmentEntity({
            subject: dbModel.subject,
            environment: dbModel._value,
        });
    }
}
