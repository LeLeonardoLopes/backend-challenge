import { IsString, IsNotEmpty, ValidateNested, Matches } from "class-validator";
import { Type } from "class-transformer";

export class MoneyDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: "Amount must be a non-negative string with up to 2 decimal places",
  })
  amount!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{3}$/, { message: "Currency must be 3 uppercase letters (ISO-4217)" })
  currency!: string;
}

export class CreateWalletDto {
  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}
