import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { MenuCategoryResponseDto } from './dto/menu-category-response.dto';
import { MenuItemResponseDto } from './dto/menu-item-response.dto';
import { MenuService } from './menu.service';

@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get('categories')
  findCategories(): Promise<MenuCategoryResponseDto[]> {
    return this.menuService.findCategories();
  }

  @Get('items')
  findItems(): Promise<MenuItemResponseDto[]> {
    return this.menuService.findItems();
  }

  @Get('items/:id')
  findItemById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<MenuItemResponseDto> {
    return this.menuService.findItemById(id);
  }
}
