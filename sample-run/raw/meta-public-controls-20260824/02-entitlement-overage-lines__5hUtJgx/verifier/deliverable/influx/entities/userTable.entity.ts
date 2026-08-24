import { Environment } from '../../users/dto/Environment.js';
import { EnvironmentEntity } from '../../users/entities/environment.entity.js';
import { UserEntity } from '../../users/entities/user.entity.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class UserTable extends BaseInfluxTable {
    public businessID: string;

    public declare _field: string;

    public _measurement = UserEntity._measurement;

    public subject: string;

    public accountExpiryDate: string;

    public temp: boolean;

    public environment: Environment;
}

export class UserActiveEnvironment extends BaseInfluxTable {
    public declare _field: string;
    public declare _value: Environment;

    public _measurement = EnvironmentEntity._measurement;

    public subject: string;
}
