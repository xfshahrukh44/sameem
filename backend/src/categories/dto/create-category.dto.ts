import {ApiProperty} from "@nestjs/swagger";
import {IsNotEmpty} from "class-validator";

export class CreateCategoryDto {
    @IsNotEmpty()
    @ApiProperty({ example: 'Name' })
    name: string;

    @ApiProperty({ example: 1 })
    parent_id: number;

    created_at: string;
}