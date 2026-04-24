export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string
          role: 'admin' | 'cashier' | 'waiter'
          restaurant_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name: string
          role: 'admin' | 'cashier' | 'waiter'
          restaurant_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: 'admin' | 'cashier' | 'waiter'
          restaurant_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_restaurant_id_fkey'
            columns: ['restaurant_id']
            isOneToOne: false
            referencedRelation: 'restaurants'
            referencedColumns: ['id']
          },
        ]
      }
      restaurants: {
        Row: {
          id: string
          name: string
          address: string | null
          phone: string | null
          logo_url: string | null
          config: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          address?: string | null
          phone?: string | null
          logo_url?: string | null
          config?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          address?: string | null
          phone?: string | null
          logo_url?: string | null
          config?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          id: string
          name: string
          description: string | null
          color: string
          sort_order: number
          restaurant_id: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          color?: string
          sort_order?: number
          restaurant_id: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          color?: string
          sort_order?: number
          restaurant_id?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'categories_restaurant_id_fkey'
            columns: ['restaurant_id']
            isOneToOne: false
            referencedRelation: 'restaurants'
            referencedColumns: ['id']
          },
        ]
      }
      products: {
        Row: {
          id: string
          name: string
          description: string | null
          price: number
          category_id: string
          restaurant_id: string
          image_url: string | null
          is_active: boolean
          stock_tracking: boolean
          stock_qty: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          price: number
          category_id: string
          restaurant_id: string
          image_url?: string | null
          is_active?: boolean
          stock_tracking?: boolean
          stock_qty?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          price?: number
          category_id?: string
          restaurant_id?: string
          image_url?: string | null
          is_active?: boolean
          stock_tracking?: boolean
          stock_qty?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'products_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'products_restaurant_id_fkey'
            columns: ['restaurant_id']
            isOneToOne: false
            referencedRelation: 'restaurants'
            referencedColumns: ['id']
          },
        ]
      }
      tables: {
        Row: {
          id: string
          name: string
          capacity: number | null
          zone: string | null
          status: 'free' | 'occupied' | 'reserved' | 'waiting_bill'
          restaurant_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          capacity?: number | null
          zone?: string | null
          status?: 'free' | 'occupied' | 'reserved' | 'waiting_bill'
          restaurant_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          capacity?: number | null
          zone?: string | null
          status?: 'free' | 'occupied' | 'reserved' | 'waiting_bill'
          restaurant_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tables_restaurant_id_fkey'
            columns: ['restaurant_id']
            isOneToOne: false
            referencedRelation: 'restaurants'
            referencedColumns: ['id']
          },
        ]
      }
      orders: {
        Row: {
          id: string
          type: 'dine_in' | 'takeaway' | 'delivery'
          status: 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
          table_id: string | null
          customer_name: string | null
          customer_phone: string | null
          notes: string | null
          total: number
          restaurant_id: string
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          type: 'dine_in' | 'takeaway' | 'delivery'
          status?: 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
          table_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          notes?: string | null
          total: number
          restaurant_id: string
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          type?: 'dine_in' | 'takeaway' | 'delivery'
          status?: 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
          table_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          notes?: string | null
          total?: number
          restaurant_id?: string
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'orders_table_id_fkey'
            columns: ['table_id']
            isOneToOne: false
            referencedRelation: 'tables'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'orders_restaurant_id_fkey'
            columns: ['restaurant_id']
            isOneToOne: false
            referencedRelation: 'restaurants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'orders_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string
          qty: number
          unit_price: number
          modifiers: Json | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          order_id: string
          product_id: string
          qty: number
          unit_price: number
          modifiers?: Json | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string
          qty?: number
          unit_price?: number
          modifiers?: Json | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'order_items_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'order_items_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      payments: {
        Row: {
          id: string
          order_id: string
          method: 'cash' | 'card' | 'transfer' | 'nequi'
          amount: number
          restaurant_id: string
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          method: 'cash' | 'card' | 'transfer' | 'nequi'
          amount: number
          restaurant_id: string
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          method?: 'cash' | 'card' | 'transfer' | 'nequi'
          amount?: number
          restaurant_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'payments_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payments_restaurant_id_fkey'
            columns: ['restaurant_id']
            isOneToOne: false
            referencedRelation: 'restaurants'
            referencedColumns: ['id']
          },
        ]
      }
      cash_shifts: {
        Row: {
          id: string
          restaurant_id: string
          opened_by: string
          closed_by: string | null
          opening_amount: number
          closing_amount: number | null
          opened_at: string
          closed_at: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          restaurant_id: string
          opened_by: string
          closed_by?: string | null
          opening_amount: number
          closing_amount?: number | null
          opened_at?: string
          closed_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          restaurant_id?: string
          opened_by?: string
          closed_by?: string | null
          opening_amount?: number
          closing_amount?: number | null
          opened_at?: string
          closed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'cash_shifts_restaurant_id_fkey'
            columns: ['restaurant_id']
            isOneToOne: false
            referencedRelation: 'restaurants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cash_shifts_opened_by_fkey'
            columns: ['opened_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cash_shifts_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      cash_movements: {
        Row: {
          id: string
          shift_id: string
          restaurant_id: string
          type: 'in' | 'out'
          amount: number
          reason: string
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          shift_id: string
          restaurant_id: string
          type: 'in' | 'out'
          amount: number
          reason: string
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          shift_id?: string
          restaurant_id?: string
          type?: 'in' | 'out'
          amount?: number
          reason?: string
          created_by?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'cash_movements_shift_id_fkey'
            columns: ['shift_id']
            isOneToOne: false
            referencedRelation: 'cash_shifts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cash_movements_restaurant_id_fkey'
            columns: ['restaurant_id']
            isOneToOne: false
            referencedRelation: 'restaurants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cash_movements_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      user_role: 'admin' | 'cashier' | 'waiter'
      table_status: 'free' | 'occupied' | 'reserved' | 'waiting_bill'
      order_type: 'dine_in' | 'takeaway' | 'delivery'
      order_status: 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
      payment_method: 'cash' | 'card' | 'transfer' | 'nequi'
      movement_type: 'in' | 'out'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience type aliases — mirroring the pattern of supabase-js generated types
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T]
