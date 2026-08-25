import { InfluxService } from '../../influx/influx.service.js';
import { InboxInfluxRow } from './inboxInfluxRow.js';

export enum InboxLevel {
    Info = 'Info',
    Warn = 'Warn',
    Error = 'Error',
}
export enum IsArchived {
    archived = 'archived',
    notArchived = 'notArchived',
}
export class Inbox {
    public static _measurement = 'inbox';
    public inboxId: string;
    public title: string;
    public description: string;
    public level: string;
    public isArchived: string;
    public messageReceivedDate: string;
    public businessID: string;

    constructor({
        inboxId,
        title,
        description,
        level,
        isArchived,
        messageReceivedDate,
        businessID,
    }: {
        inboxId: string;
        title: string;
        description: string;
        level: string;
        isArchived: string;
        messageReceivedDate: string;
        businessID: string;
    }) {
        this.inboxId = inboxId;
        this.title = title;
        this.description = description;
        this.level = level;
        this.isArchived = isArchived;
        this.messageReceivedDate = messageReceivedDate;
        this.businessID = businessID;
    }

    static transformer(inboxEntity: Inbox, influxService: InfluxService) {
        const inboxEntityPoint = influxService.getPoint(Inbox._measurement);

        inboxEntityPoint.stringField('inboxId', inboxEntity.inboxId);

        inboxEntityPoint.tag('inboxId', inboxEntity.inboxId);
        inboxEntityPoint.tag('title', inboxEntity.title);
        inboxEntityPoint.tag('description', inboxEntity.description);
        inboxEntityPoint.tag('level', inboxEntity.level);
        inboxEntityPoint.tag('isArchived', inboxEntity.isArchived);
        inboxEntityPoint.tag('messageReceivedDate', inboxEntity.messageReceivedDate);
        inboxEntityPoint.tag('businessID', inboxEntity.businessID);

        return [inboxEntityPoint];
    }

    static dbModelToEntity(dbModel: any): Inbox {
        if (dbModel) {
            const { inboxId, title, description, level, isArchived, messageReceivedDate, businessID } = dbModel;
            return new Inbox({ inboxId, title, description, level, isArchived, messageReceivedDate, businessID });
        }
    }

    static async getInboxbyId({
        businessID,
        inboxId,
        influxService,
    }: {
        businessID: string;
        inboxId: string;
        influxService: InfluxService;
    }): Promise<Inbox[]> {
        const queryApi = influxService.queryAPIInstance();
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const inboxFluxQuery = `from(bucket: "${process.env.STAGE}-config")
            |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
            |> filter(fn: (r) => r["_measurement"] == "${Inbox._measurement}")
            |> filter(fn: (r) => r["inboxId"] == "${inboxId}")
            |> filter(fn: (r) => r["businessID"] == "${businessID}")
            |> group(columns: ["_measurement"], mode:"by")
            |> sort(columns: ["_time"], desc: true)
            |> unique(column: "inboxId")
            |> filter(fn: (r) => not exists r.isArchived or r.isArchived != "${IsArchived.archived}")`;

        const res = await queryApi.collectRows<InboxInfluxRow>(inboxFluxQuery);

        return res.map((row) => Inbox.dbModelToEntity(row));
    }
    static async getAllInboxes({
        businessID,
        influxService,
    }: {
        businessID: string;
        influxService: InfluxService;
    }): Promise<Inbox[]> {
        const queryApi = influxService.queryAPIInstance();
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const inboxFluxQuery = `from(bucket: "${process.env.STAGE}-config")
            |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
            |> filter(fn: (r) => r["_measurement"] == "${Inbox._measurement}")
            |> filter(fn: (r) => r["businessID"] == "${businessID}")
            |> group(columns: ["_measurement"], mode:"by")
            |> sort(columns: ["_time"], desc: true)
            |> unique(column: "inboxId")
            |> filter(fn: (r) => not exists r.isArchived or r.isArchived != "${IsArchived.archived}")`;

        const res = await queryApi.collectRows<InboxInfluxRow>(inboxFluxQuery);

        return res.map((row) => Inbox.dbModelToEntity(row));
    }
}
