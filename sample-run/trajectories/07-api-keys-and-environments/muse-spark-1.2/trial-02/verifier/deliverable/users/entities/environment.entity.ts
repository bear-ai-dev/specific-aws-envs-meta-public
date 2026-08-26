import { UserActiveEnvironment } from '../../influx/entities/userTable.entity.js';
import { Environment } from '../dto/Environment.js';
import { Point } from '@influxdata/influxdb-client';
import { InfluxService } from '../../influx/influx.service.js';

export class EnvironmentEntity {
    public static _measurement = 'UserActiveEnvironment';
    public subject: string;
    public environment: Environment;

    constructor({ subject, environment }: { subject: string; environment?: Environment }) {
        this.subject = subject;
        this.environment = environment ? environment : Environment.PRODUCTION;
    }

    static dbModelToEntity(dbModel: UserActiveEnvironment) {
        return new EnvironmentEntity({
            subject: dbModel.subject,
            environment: dbModel._value,
        });
    }

    static transformer(entity: EnvironmentEntity, influxService: InfluxService): Array<Point> {
        const point = influxService.getPoint(EnvironmentEntity._measurement);
        point.tag('subject', entity.subject);
        point.stringField('environment', entity.environment);
        return [point];
    }
}
