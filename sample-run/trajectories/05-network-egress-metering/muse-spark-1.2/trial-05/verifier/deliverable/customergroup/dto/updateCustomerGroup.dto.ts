export class UpdateCustomergroupDto {
    groupId?: string;
    groupName?: string;
    groupDescription?: string;
    parentId: string;
    metadata?: Record<string, string>;
    businessID: string;
}
