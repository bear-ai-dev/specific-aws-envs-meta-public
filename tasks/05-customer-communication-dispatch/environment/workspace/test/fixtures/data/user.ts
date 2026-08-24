import { UserTable } from '../../../src/influx/entities/userTable.entity';
import { Environment } from '../../../src/users/dto/Environment';
import { UserEntity } from '../../../src/users/entities/user.entity';

export const productionBusinessID = 'foobar-production';
export const sandboxBusinessID = 'foobar-sandbox';
export const subject = '12345';
export const UserTableValue: UserTable[] = [
    {
        businessID: productionBusinessID,
        environment: Environment.PRODUCTION,
        _value: 'live',
        subject: '12345',
        _time: '2021-01-01T00:00:00Z',
        _field: 'userStatus',
        _measurement: UserEntity._measurement,
        accountExpiryDate: '2030-01-01T00:00:00Z',
        temp: false,
    },
    {
        businessID: sandboxBusinessID,
        environment: Environment.SANDBOX,
        _value: 'live',
        subject: '12345',
        _time: '2021-01-01T00:00:00Z',
        _field: 'userStatus',
        _measurement: UserEntity._measurement,
        accountExpiryDate: '2030-01-01T00:00:00Z',
        temp: false,
    },
];
